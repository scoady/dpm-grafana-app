import React, { useEffect, useState } from 'react';
import { Drawer, Spinner, Collapse, TextArea } from '@grafana/ui';
import {
  SceneQueryRunner,
  SceneTimeRange,
  PanelBuilders,
  EmbeddedScene,
  SceneFlexLayout,
  SceneFlexItem,
  SceneVariableSet,
  AdHocFiltersVariable,
  VariableValueSelectors,
  CustomVariable,
} from '@grafana/scenes';
import { DataSourceInstanceSettings } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { openai } from '@grafana/llm';
import { scan } from 'rxjs/operators';

interface MetricDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  metric: string;
  datasource: DataSourceInstanceSettings;
}

export const MetricDrawer: React.FC<MetricDrawerProps> = ({ isOpen, onClose, metric, datasource }) => {
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const [collectorConfig, setCollectorConfig] = useState<string>('');
  const [llmReply, setLlmReply] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const cluster = 'scoady-dev';
    const baseExpr = `${metric}{cluster="${cluster}"}`;
    const timeRange = new SceneTimeRange({ from: 'now-1h', to: 'now' });

    // Create a variable for selecting group by dimensions
    // Use the exact label names as they appear in Prometheus (lowercase)
    const groupByVar = new CustomVariable({
      name: 'groupBy',
      label: 'groupBy',
      value: 'job', // Default value
      // Use the actual label names as they appear in Prometheus
      query: 'instance : instance, cluster : cluster, job : job, pod : pod, namespace : namespace',
    });

    // Create the ad hoc filters variable
    const filtersVar = new AdHocFiltersVariable({
      name: 'Filters',
      datasource: { type: 'prometheus', uid: datasource.uid },
      filters: [],
    });

    const variables = new SceneVariableSet({
      variables: [groupByVar, filtersVar],

    });

    const runner1 = new SceneQueryRunner({
      datasource: { type: 'prometheus', uid: datasource.uid },
      queries: [{ 
        refId: 'A', 
        expr: `sum by($groupBy) (${baseExpr})`
      }],
      $variables: variables,
    });
    
    const runner2 = new SceneQueryRunner({
      datasource: { type: 'prometheus', uid: datasource.uid },
      queries: [{ 
        refId: 'B', 
        expr: `avg by($groupBy) (count_over_time(${baseExpr}[60m]) / 60)`

      }],
      $variables: variables,
      
      
    });
    
    const runner3 = new SceneQueryRunner({
      datasource: { type: 'prometheus', uid: datasource.uid },
      queries: [{ 
        refId: 'C', 
        expr: `sum by($groupBy)(count_over_time(${baseExpr}[5m]))/5`
      }],
      $variables: variables,
    });

    // Configure panels with appropriate legends to show the grouped values
    const panel1 = PanelBuilders.timeseries()
      .setTitle(`Datapoint count grouped by \${groupBy}`)
      .setData(runner1)
      .build();
    
    const panel2 = PanelBuilders.timeseries()
      .setTitle(`Average value grouped by \${groupBy}`)
      .setData(runner2)
      .build();
    
    const panel3 = PanelBuilders.timeseries()
      .setTitle(`Approx. DPM (datapoints/min) grouped by \${groupBy}`)
      .setData(runner3)
      .build();

    const newScene = new EmbeddedScene({
      $timeRange: timeRange,
      $variables: variables,
      body: new SceneFlexLayout({
        direction: 'column',
        children: [
          new SceneFlexItem({ 
            body: new VariableValueSelectors({})
          }),
          new SceneFlexItem({ height: 300, body: panel1 }),
          new SceneFlexItem({ height: 300, body: panel2 }),
          new SceneFlexItem({ height: 300, body: panel3 }),
        ],
      }),
    });

    setScene(newScene);

    async function fetchCollectorAndExplain() {
      setCollectorConfig('');
      setLlmReply('');
      setLlmLoading(true);

      try {
        const listResp = await getBackendSrv()
          .fetch({
            method: 'POST',
            url: '/api/plugins/dpm-finder/resources/fleet-management-api/ListCollectors',
            headers: { 'Content-Type': 'application/json' },
            data: '{}',
          })
          .toPromise();

        const matching = listResp.data?.collectors?.find(
          (c: any) => c.attributes?.cluster === cluster
        );

        if (!matching) {
          setCollectorConfig(`No collector found for cluster: ${cluster}`);
          setLlmReply('Unable to analyze config: no collector found.');
          setLlmLoading(false);
          return;
        }

        const configResp = await getBackendSrv()
          .fetch({
            method: 'POST',
            url: '/api/plugins/dpm-finder/resources/fleet-management-api/GetConfig',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ id: matching.id }),
          })
          .toPromise();

        const config = configResp.data?.content || 'No config returned.';
        setCollectorConfig(config);

        const prompt =
          `Explain the Prometheus metric "${metric}".\n\n` +
          `This metric is being collected by a Grafana Alloy collector with the following configuration:\n\n` +
          '\n' + config + '\n' +
          '\n\n' + '' +
          `Please analyze the configuration provided and highlight any potential contributors to datapoints per minute that you can observe.`;

        const stream = openai
          .streamChatCompletions({
            model: openai.Model.LARGE,
            messages: [{ role: 'user', content: prompt }],
          })
          .pipe(
            scan((acc, response) => {
              const content = response.choices?.[0]?.delta?.content || '';
              return acc + content;
            }, '')
          );

        stream.subscribe({
          next: (chunk) => setLlmReply(chunk),
          error: (err) => {
            console.error(err);
            setLlmReply('Error communicating with LLM.');
            setLlmLoading(false);
          },
          complete: () => setLlmLoading(false),
        });
      } catch (err) {
        console.error('Collector fetch or LLM failed:', err);
        setCollectorConfig('Error fetching config.');
        setLlmReply('Failed to run analysis.');
        setLlmLoading(false);
      }
    }

    fetchCollectorAndExplain();
  }, [isOpen, metric, datasource]);

  if (!scene) return null;

  return (
    <Drawer
      title={`Datapoints for ${metric}`}
      isOpen={isOpen}
      onClose={onClose}
      placement="right"
      width="50%"
    >
      <div style={{ marginBottom: '1rem' }}>
        <h4>LLM Explanation</h4>
        {llmLoading ? <Spinner /> : (
          <TextArea
            rows={10}
            value={llmReply}
            readOnly
            style={{ width: '100%', backgroundColor: '#111', color: 'white' }}
          />
        )}
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <scene.Component model={scene} />
      </div>

      {collectorConfig && (
        <div style={{ marginTop: '1rem' }}>
          <Collapse
            label="Collector Configuration"
            isOpen={configExpanded}
            onToggle={() => setConfigExpanded(!configExpanded)}
          >
            <TextArea
              rows={15}
              value={collectorConfig}
              readOnly
              style={{ width: '100%', backgroundColor: '#111', color: 'white' }}
            />
          </Collapse>
        </div>
      )}
    </Drawer>
  );
};