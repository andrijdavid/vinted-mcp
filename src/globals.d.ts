declare function require(moduleName: string): any;

declare const process: {
  env: Record<string, string | undefined>;
  argv?: string[];
  platform?: string;
  cwd?: () => string;
  on?: (...args: any[]) => void;
  exit?: (code?: number) => never;
};
