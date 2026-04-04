FROM public.ecr.aws/lambda/python:3.11

# Install uv
RUN pip install --no-cache-dir uv

WORKDIR ${LAMBDA_TASK_ROOT}

# Copy dependency files and install into system Python (Lambda runtime uses system interpreter)
COPY pyproject.toml uv.lock ./
RUN UV_SYSTEM_PYTHON=1 uv sync --frozen --no-dev

# Copy application code
COPY . .

# Lambda event handler
CMD ["lambda_function.lambda_handler"]
