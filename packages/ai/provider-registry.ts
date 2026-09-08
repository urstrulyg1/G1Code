import type { AIProvider } from "./provider";
import {
  ExperientialLabsProvider,
  EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
} from "./experiential-labs";

export class ProviderRegistry {
  private providers = new Map<
    string,
    (endpoint: string, apiKey: string) => AIProvider
  >();

  constructor() {
    this.register(
      "experiential-labs",
      (endpoint, apiKey) =>
        new ExperientialLabsProvider(
          endpoint || EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
          apiKey,
        ),
    );
  }

  register(
    id: string,
    factory: (endpoint: string, apiKey: string) => AIProvider,
  ) {
    this.providers.set(id.toLowerCase(), factory);
  }

  create(id: string, endpoint: string, apiKey: string): AIProvider {
    const factory =
      this.providers.get(id.toLowerCase()) ??
      this.providers.get("experiential-labs");

    if (!factory) {
      return new ExperientialLabsProvider(endpoint, apiKey);
    }

    return factory(endpoint, apiKey);
  }

  has(id: string): boolean {
    return this.providers.has(id.toLowerCase());
  }
}

export const globalProviderRegistry = new ProviderRegistry();
