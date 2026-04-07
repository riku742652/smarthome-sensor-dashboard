FROM python:3.11-slim

# Install Lambda Web Adapter
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

# Install uv
RUN pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# 仮想環境を作成して依存関係をインストール
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Environment variables for Lambda Web Adapter
ENV PORT=8000
ENV AWS_LWA_INVOKE_MODE=response_stream

# uv の仮想環境内の Python で uvicorn を起動
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
