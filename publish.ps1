"Building project..."
npm run build:ts
npm run build

"Publishing project..."
npm publish ./dist --tag=next

# npm dist-tag add @novorender/data-js-api@0.0.1 stable
