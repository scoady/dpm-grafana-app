import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2, Spinner, MultiSelect } from '@grafana/ui';
import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import {
  DataSourceInstanceSettings,
} from '@grafana/data';
import {
  SceneQueryRunner,
  SceneTimeRange,
  PanelBuilders,
  EmbeddedScene,
  SceneFlexLayout,
  SceneFlexItem,
} from '@grafana/scenes';
import { MetricDrawer } from '../components/MetricDrawer';

const getStyles = () => ({
  wrapper: css`display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: Open Sans;`,
  content: css`display: flex; flex: 1; overflow: hidden;`,
  leftPanel: css`width: 50%; padding: 20px; overflow: auto;`,
  footerPanel: css`height: 200px; border-top: 1px solid #444; background: #111; padding: 10px;`,
  metricRow: css`
    margin-bottom: 10px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;
    background-color: #1f1f1f; &:hover { background-color: #2a2a2a; }
  `,
});

interface Metric {
  metric: string;
  dpm: number;
  datasource: DataSourceInstanceSettings;
}

export default function HomePage() {
  const styles = useStyles2(getStyles);
  const [datasources, setDatasources] = useState<DataSourceInstanceSettings[]>([]);
  const [selectedDatasources, setSelectedDatasources] = useState<Array<{ label: string; value: string }>>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedDatasource, setSelectedDatasource] = useState<DataSourceInstanceSettings | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [footerScene, setFooterScene] = useState<EmbeddedScene | null>(null);

  useEffect(() => {
    async function loadDatasources() {
      const dsList = await getDataSourceSrv().getList({ type: 'prometheus' });
      setDatasources(dsList);
    }
    loadDatasources();
  }, []);

  useEffect(() => {
    async function fetchMetrics() {
      if (!selectedDatasources.length) {
        setMetrics([]);
        return;
      }

      setLoading(true);
      const fetchedMetrics: Metric[] = [];

      for (const ds of selectedDatasources) {
        const datasource = datasources.find((d) => d.uid === ds.value);
        if (!datasource) continue;

        const seriesResp = await getBackendSrv().datasourceRequest({
          method: 'GET',
          url: `/api/datasources/proxy/${datasource.id}/api/v1/series`,
          params: {
            'match[]': '{cluster=~".+"}',
            start: ((Date.now() / 1000 - 300) | 0).toString(),
            end: ((Date.now() / 1000) | 0).toString(),
          },
        });

        const rawSeries = seriesResp.data.data as Array<Record<string, string>>;
        const metricNames = Array.from(new Set(rawSeries.map((s) => s['__name__']))).slice(0, 10);

        await Promise.all(metricNames.map(async (metric) => {
          const query = `count_over_time(${metric}{cluster=~".+"}[5m])/5`;
          const response = await getBackendSrv().datasourceRequest({
            method: 'GET',
            url: `/api/datasources/proxy/${datasource.id}/api/v1/query`,
            params: { query },
          });

          const results = response.data.data.result;
          if (results.length && results[0].value.length > 1) {
            const dpm = parseFloat(results[0].value[1]);
            if (dpm > 0) {
              fetchedMetrics.push({ metric, dpm, datasource });
            }
          }
        }));

        if (fetchedMetrics.length && !footerScene) {
          const runner = new SceneQueryRunner({
            datasource: {
              type: 'prometheus',
              uid: datasource.uid,
            },
            queries: [
              {
                refId: 'A',
                expr: `sum by (cluster) (count_over_time(scrape_samples_scraped[5m]))/5`,
              },
            ],
          });

          const footer = new EmbeddedScene({
            $data: runner,
            $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now' }),
            body: new SceneFlexLayout({
              direction: 'row',
              children: [
                new SceneFlexItem({
                  height: 180,
                  body: PanelBuilders.timeseries().setTitle('Rolling DPM Computation (5m)').setData(runner).build(),
                }),
              ],
            }),
          });

          setFooterScene(footer);
        }
      }

      fetchedMetrics.sort((a, b) => b.dpm - a.dpm);
      setMetrics(fetchedMetrics);
      setLoading(false);
    }

    fetchMetrics();
  }, [selectedDatasources, datasources]);

  const handleMetricSelect = async (metric: string, datasource: DataSourceInstanceSettings) => {
    setSelectedMetric(metric);
    setSelectedDatasource(datasource);
    setDrawerOpen(true);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.content}>
        <div className={styles.leftPanel}>
          <MultiSelect
            placeholder="Select datasources..."
            options={datasources.map((ds) => ({ label: ds.name, value: ds.uid }))}
            value={selectedDatasources}
            onChange={setSelectedDatasources}
          />

          {loading ? <Spinner /> : metrics.map((m) => (
            <div key={m.metric} className={styles.metricRow} onClick={() => handleMetricSelect(m.metric, m.datasource)}>
              <strong>{m.metric}</strong> ({m.dpm.toFixed(2)} DPM)
            </div>
          ))}
        </div>
      </div>

      {footerScene && (
        <div className={styles.footerPanel}>
          <footerScene.Component model={footerScene} />
        </div>
      )}

      {drawerOpen && selectedMetric && selectedDatasource && (
        <MetricDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          metric={selectedMetric}
          datasource={selectedDatasource}
        />
      )}
    </div>
  );
}
