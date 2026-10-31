AionUi — Copyright 2025 AionUi (aionui.com), Apache License 2.0.

Source: https://github.com/iOfficeAI/AionUi/blob/6744099b279b991c17e31c243f0920477bd31cb6/packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts

Today extracts `getOptionCurrentValue`, `findConfigOption` and
`deriveSelectOption` for its Tauri/Node ACP host. Changes: remove React and
Electron dependencies, accept ACP camelCase fields, flatten grouped options.
The surrounding agent registry, workspace binding and business tool bridge are
Today code. This is not the AionUi application or its bundled aionrs backend.
