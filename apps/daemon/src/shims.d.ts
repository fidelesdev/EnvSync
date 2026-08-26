declare module "selfsigned" {
  type GenerateOptions = {
    days?: number;
    keySize?: number;
    algorithm?: string;
  };

  type PemResult = {
    cert: string;
    private: string;
    public: string;
  };

  function generate(
    attrs: Array<{ name: string; value: string }>,
    opts?: GenerateOptions,
  ): PemResult;

  export default { generate };
}

declare module "bonjour-service" {
  export class Bonjour {
    publish(options: {
      name: string;
      type: string;
      port: number;
      txt?: Record<string, string>;
    }): unknown;
    find(options: { type: string }): {
      on(event: "up" | "down", listener: (service: BonjourService) => void): void;
      stop(): void;
    };
    destroy(): void;
  }

  export type BonjourService = {
    name: string;
    host: string;
    port: number;
    referer?: { address?: string };
    txt?: Record<string, string>;
  };
}
