import { AppPlugin } from '@grafana/data';
import { AppConfig } from './components/AppConfig/AppConfig';
import HomePage from './pages/HomePage';

export const plugin = new AppPlugin()
  .setRootPage(HomePage)
  .addConfigPage({
    title: 'Configuration',
    icon: 'cog',
    body: AppConfig,
    id: 'config',
  });
