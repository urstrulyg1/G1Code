# Context Engine

The context manager ranks inputs rather than serializing a repository. Ranking starts with the user prompt, selected/open files, project instructions, current diff, and recent tool observations; it then adds search and symbol results, imports, test/build metadata, and bounded terminal output.

The repository index stores file metadata, language, symbols, imports, hashes, and Git timestamps. Indexing is incremental and excludes generated directories, dependency caches, and secrets. Semantic retrieval is optional and must degrade to keyword/symbol search when embeddings are unavailable.
