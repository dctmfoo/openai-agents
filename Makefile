.PHONY: help install install-admin install-all gateway gateway-prod admin logs chat-dashboard

help:
	@echo "Available targets:"
	@echo "  make install          # Install root dependencies"
	@echo "  make install-admin    # Install apps/admin dependencies"
	@echo "  make install-all      # Install both root + admin deps"
	@echo "  make gateway          # Run gateway (Telegram bot + admin API) in dev mode"
	@echo "  make gateway-prod     # Build and run gateway from dist"
	@echo "  make admin            # Run the Tauri admin app"
	@echo "  make logs             # Tail runtime + event logs from HALO_HOME"
	@echo "  make chat-dashboard   # Run gateway + log tail + Tauri admin together"

install:
	pnpm install

install-admin:
	cd apps/admin && pnpm install

install-all: install install-admin

gateway:
	pnpm exec tsx src/gateway/start.ts

gateway-prod:
	pnpm build
	pnpm start:gateway

admin:
	cd apps/admin && pnpm tauri:dev

logs:
	@bash -c 'set -euo pipefail; \
		HALO_HOME_DIR="$${HALO_HOME:-$$HOME/.halo}"; \
		LOG_DIR_PATH="$${LOG_DIR:-$$HALO_HOME_DIR/logs}"; \
		mkdir -p "$$LOG_DIR_PATH"; \
		touch "$$LOG_DIR_PATH/runtime.jsonl" "$$LOG_DIR_PATH/events.jsonl"; \
		echo "Tailing logs from $$LOG_DIR_PATH"; \
		tail -n 40 -F "$$LOG_DIR_PATH/runtime.jsonl" "$$LOG_DIR_PATH/events.jsonl"'

chat-dashboard:
	@bash -c 'set -euo pipefail; \
		HALO_HOME_DIR="$${HALO_HOME:-$$HOME/.halo}"; \
		LOG_DIR_PATH="$${LOG_DIR:-$$HALO_HOME_DIR/logs}"; \
		HOST="$${GATEWAY_HOST:-127.0.0.1}"; \
		PORT="$${GATEWAY_PORT:-8787}"; \
		if [ -z "$${TELEGRAM_BOT_TOKEN:-}" ]; then \
			echo "ERROR: TELEGRAM_BOT_TOKEN is not set"; \
			exit 1; \
		fi; \
		mkdir -p "$$LOG_DIR_PATH"; \
		touch "$$LOG_DIR_PATH/runtime.jsonl" "$$LOG_DIR_PATH/events.jsonl"; \
		echo "Starting gateway on $$HOST:$$PORT..."; \
		echo "HALO_HOME=$$HALO_HOME_DIR"; \
		echo "LOG_DIR=$$LOG_DIR_PATH"; \
		pnpm exec tsx src/gateway/start.ts & \
		GATEWAY_PID=$$!; \
		tail -n 0 -F "$$LOG_DIR_PATH/events.jsonl" & \
		TAIL_PID=$$!; \
		trap "echo Stopping gateway + log tail...; kill $$TAIL_PID $$GATEWAY_PID 2>/dev/null || true" EXIT INT TERM; \
		sleep 2; \
		echo "Starting Tauri admin app..."; \
		cd apps/admin && pnpm tauri:dev'
