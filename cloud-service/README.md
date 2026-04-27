# FileMind Cloud Service

This is a separate, deployable web version of FileMind. Users upload a folder from the browser, the service analyzes filenames, folder context, file types, and short text previews with the existing Ollama model choices, then returns a ZIP containing a replacement organized folder.

The cloud service uses the same model names as the desktop app:

- `qwen3:14b` as **High Effort**
- `qwen3:4b` as **Low Effort**

If Ollama is unavailable or a model request fails, the service falls back to built-in organization rules so uploads can still produce a replacement ZIP.

## Limits

Defaults are intentionally conservative for Replit-style hosting:

- `MAX_TOTAL_UPLOAD_MB=75`
- `MAX_FILE_MB=20`
- `MAX_FILES=500`
- `ZIP_TTL_MINUTES=15`
- `OLLAMA_HOST=http://127.0.0.1:11434`
- `FILEMIND_DEFAULT_MODEL=qwen3:14b`
- `FILEMIND_SKIP_MODEL_PULL=1` skips automatic model pulls on Replit

You can override these with environment variables.

## Run Locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Deploy On Replit

Create or import a Replit app using this `cloud-service` folder as the app root. The included `.replit` and `replit.nix` files install Node and Ollama, run `scripts/start-replit.sh`, pull the two supported Ollama models, and expose port `3000`.

`qwen3:14b` is large. If your Replit machine does not have enough memory or disk, set `FILEMIND_SKIP_MODEL_PULL=1`, manually pull only `qwen3:4b`, and set `FILEMIND_DEFAULT_MODEL=qwen3:4b`.

Actual publishing still has to be done from your Replit account because deployment requires your Replit authorization and billing/workspace settings.
