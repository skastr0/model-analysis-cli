# model-analysis CLI

This package is the npm runner entrypoint for `model-analysis`.

It exposes the `model-analysis` command through a small Node launcher and delegates to the matching prebuilt Bun standalone binary package for the current platform.

```bash
npx -y --package @skastr0/model-analysis-cli model-analysis --version
bunx -p @skastr0/model-analysis-cli model-analysis --version
pnpm --package @skastr0/model-analysis-cli dlx model-analysis --version
```

The source repository and full documentation live at <https://github.com/skastr0/model-analysis-cli>.
