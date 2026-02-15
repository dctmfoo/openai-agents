.PHONY: build clean rebuild start-gateway dev-gateway dev-telegram test lint

build:
	pnpm exec tsc -p tsconfig.json

clean:
	rm -rf dist

rebuild: clean build

start-gateway: build
	node dist/gateway/start.js

dev-gateway:
	pnpm exec tsx src/gateway/start.ts

dev-telegram:
	pnpm exec tsx src/interfaces/telegram/start.ts

test:
	pnpm exec vitest run

lint:
	pnpm exec eslint .
