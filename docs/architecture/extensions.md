# Extension Architecture

Extensions will be manifest-driven capabilities loaded by the main process with explicit permissions. Contributions include commands, languages, themes, providers, tools, and panel views. An extension receives a scoped API rather than unrestricted Electron access. VS Code compatibility is not assumed; compatibility can be evaluated after the core contribution API stabilizes.
