import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // V2.7b C10b — THE BORDER LONGHAND BAN. Twice this project has silently lost a border colour:
    // CommentFeed's purple accent in V2.3b (a `border` shorthand written after the longhand wiped
    // it) and Act II's selected rail card in C9b (a `borderColor` spread over an object carrying
    // `border`, which React warns about and the browser can drop).
    //
    // It bans the LONGHAND outright rather than looking for shorthand+longhand pairs, for a
    // structural reason: in this codebase the two almost never meet inside one object literal. They
    // meet across a SPREAD — `{...base, ...(on ? active : null)}` — which a per-object selector
    // cannot see, and which is exactly the shape of both historical bugs. There are zero legitimate
    // uses of these three keys in web/, so the outright ban has no false positives and catches the
    // spread case for free. The side longhands (borderLeft/Top/Right/Bottom) are NOT banned: the
    // documented `border: 'none'` then `borderLeft: '3px solid …'` ordering is correct and common.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "ObjectExpression > Property[key.name=/^border(Color|Width|Style)$/]",
        message:
          'Use the full `border` shorthand, not a longhand: the two get combined across spreads and ' +
          'rerenders, where React warns and the value can be dropped (CommentFeed V2.3b, ActTwo C9b).',
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
