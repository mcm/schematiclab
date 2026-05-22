import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
  {
    files: ["src/components/**/*.tsx", "src/app/**/*.tsx", "src/lib/**/*.tsx"],
    ignores: ["**/*.test.tsx", "**/*.test.ts"],
  },
]);

export default eslintConfig;
