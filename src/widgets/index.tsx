import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';

async function onActivate(plugin: ReactRNPlugin) {
  // Registrar apenas o widget do dicionário
  await plugin.app.registerWidget(
    "selected_text_dictionary",
    WidgetLocation.SelectedTextMenu,
    {
      dimensions: { height: "auto", width: "100%" },
      widgetTabTitle: "DicioPT-BR",
    }
  );
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
