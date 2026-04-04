FROM public.ecr.aws/lambda/python:3.11

# Install Lambda Web Adapter
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.7.1 /lambda-adapter /opt/extensions/lambda-adapter

# Install uv
RUN pip install --no-cache-dir uv

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy dependency files and install into system Python (Lambda runtime uses system interpreter)
COPY pyproject.toml uv.lock ./
RUN UV_SYSTEM_PYTHON=1 uv sync --frozen --no-dev

# Copy application code
COPY . .

# Environment variables for Lambda Web Adapter
ENV PORT=8000
ENV AWS_LWA_INVOKE_MODE=response_stream

# Start FastAPI with uvicorn
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
