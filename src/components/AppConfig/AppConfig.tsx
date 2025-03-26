import React, { useState, ChangeEvent } from 'react';
import { DataSourcePicker, getBackendSrv } from '@grafana/runtime';
import { AppPluginMeta, KeyValue } from '@grafana/data';
import { Field, Input, FieldSet, Button } from '@grafana/ui';

interface Props {
  plugin: AppPluginMeta<KeyValue>;
  query: KeyValue;
  onChange: (jsonData: KeyValue) => void;
}

export const AppConfig: React.FC<Props> = ({ plugin, query, onChange }) => {
  const { jsonData = {}, secureJsonFields = {} } = plugin;
  const currentDatasource = jsonData.datasourceUid ? { uid: jsonData.datasourceUid } : undefined;

  // State for form fields
  const [fleetBaseURL, setFleetBaseURL] = useState(jsonData.fleetBaseURL || '');
  const [fleetAuthToken, setFleetAuthToken] = useState('');
  const [isFleetAuthTokenSet, setIsFleetAuthTokenSet] = useState(Boolean(secureJsonFields.fleetAuthToken));

  // Save settings to Grafana
  const saveSettings = async () => {
    const data = {
      enabled: plugin.enabled,
      pinned: plugin.pinned,
      jsonData: {
        ...jsonData,
        fleetBaseURL
      }
    };

    // Only include auth token if it's been changed
    if (fleetAuthToken) {
      data.secureJsonData = {
        fleetAuthToken
      };
    }

    try {
      await getBackendSrv().fetch({
        url: `/api/plugins/${plugin.id}/settings`,
        method: 'POST',
        data
      });
      
      // Update token state after successful save
      if (fleetAuthToken) {
        setIsFleetAuthTokenSet(true);
        setFleetAuthToken('');
      }
      
      // Reload to apply changes
      window.location.reload();
    } catch (error) {
      console.error('Failed to save settings', error);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      {/* Data Source Selector */}
      <FieldSet label="Data Source">
        <Field label="Prometheus Data Source">
          <DataSourcePicker
            current={currentDatasource}
            onChange={(ds) => {
              // Just update the local state in jsonData
              onChange({ 
                ...query, 
                datasourceUid: ds.uid 
              });
            }}
            filter={(ds) => ds.type === 'prometheus'}
          />
        </Field>
      </FieldSet>

      {/* Fleet Management URL */}
      <FieldSet label="Fleet Management">
        <Field label="Fleet Management URL">
          <Input
            value={fleetBaseURL}
            placeholder="https://fleet-management-prod-014.grafana.net/collector.v1.CollectorService"
            onChange={(e) => setFleetBaseURL(e.target.value)}
            width={60}
          />
        </Field>
      </FieldSet>

      {/* Authentication */}
      <FieldSet label="Authentication">
        <Field label="Auth Token" description="Authentication token for Fleet Management">
        <Input
  type="password"
  value={fleetAuthToken}
  placeholder={isFleetAuthTokenSet ? 'configured' : ''}
  onChange={(e) => setFleetAuthToken(e.target.value)}
  onPaste={(e) => {
    const pastedText = e.clipboardData.getData('text');
    setFleetAuthToken(pastedText);
  }}
  width={60}
/>
        </Field>
        
        {isFleetAuthTokenSet && (
          <Button 
            variant="secondary" 
            onClick={() => {
              setFleetAuthToken('');
              setIsFleetAuthTokenSet(false);
              
              // Reset the secure field
              const data = {
                secureJsonFields: {
                  ...secureJsonFields,
                  fleetAuthToken: false
                }
              };
              
              getBackendSrv().fetch({
                url: `/api/plugins/${plugin.id}/settings`,
                method: 'POST',
                data
              });
            }}
          >
            Reset Token
          </Button>
        )}
      </FieldSet>

      {/* Save Button */}
      <Button variant="primary" onClick={saveSettings} style={{ marginTop: '20px' }}>
        Save
      </Button>
    </div>
  );
};