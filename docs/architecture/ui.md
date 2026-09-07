# UI Architecture

The shell uses a persistent three-column workbench: activity rail, explorer/editor workspace, and G1Code agent panel, with a bottom panel for terminal, problems, output, and activity. UI state is local and feature-owned; domain events from the main process are append-only and renderable as timeline entries.

The visual language is dark graphite with electric lime accents, compact typography, and high information density. The agent panel must distinguish model text from verified operations: activity entries are only created from actual bridge responses.
