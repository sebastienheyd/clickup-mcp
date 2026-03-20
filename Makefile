.DEFAULT_GOAL := help
.PHONY: help build dev start cli test prettier publish mcpb clean

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Build the TypeScript project
	npm run build

dev: ## Watch mode: recompile and restart automatically
	npm run dev

start: ## Start the MCP server
	npm run start

cli: ## Run the MCP test CLI (usage: make cli ARGS="toolName key=value")
	npm run cli $(ARGS)

test: ## Run tests
	npm run test

prettier: ## Format code with Prettier
	npm run prettier

clean: ## Remove the dist folder
	rm -rf dist

mcpb: ## Build and package as .mcpb
	npm run mcpb

publish: ## Publish to npmjs (auto-login if not authenticated)
	@npm whoami 2>/dev/null || (echo "Not logged in to npmjs, starting login..." && npm login)
	npm publish --access public
