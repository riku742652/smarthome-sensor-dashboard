# uv 移行 リサーチ

**タスク**: lambda ディレクトリの pip (requirements.txt) から uv (pyproject.toml) への依存関係管理の移行

**調査日**: 2026-04-04

**ステータス**: 完了（2026-04-04）

---

## 現状

### lambda/api の依存関係

**ファイル**: 
- `lambda/api/requirements.txt` - 本体依存：fastapi, mangum, boto3, uvicorn, pydantic
- `lambda/api/requirements-dev.txt` - 開発依存：pytest, pytest-mock, httpx
- `lambda/api/pyproject.toml` - 既に作成済み（`lambda/api` 単独向けの構成）

**構成内容**:
```
[project]
name = "lambda-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.104.0",
    "mangum>=0.17.0",
    "boto3>=1.34.0",
    "uvicorn>=0.24.0",
    "pydantic>=2.0.0",
]

[dependency-groups]
dev = [
    "pytest>=7.0",
    "pytest-mock>=3.0",
    "httpx>=0.24.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

**テスト**: 
- `lambda/api/tests/test_main.py` が存在し、pytest で実行可能な状態
- テスト実行: `pytest lambda/api/tests/`

### lambda/poller の依存関係

**ファイル**: 
- `lambda/poller/requirements.txt` - 本体依存：boto3, requests
- `lambda/poller/requirements-dev.txt` - 開発依存：pytest, pytest-mock
- `lambda/poller/pyproject.toml` - 存在しない（要作成）

**テスト**: 
- `lambda/poller/tests/test_lambda_function.py` が存在し、pytest で実行可能な状態
- テスト実行: `pytest lambda/poller/tests/`

### Dockerfile での pip 使用箇所

#### lambda/api/Dockerfile
```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```

#### lambda/poller/Dockerfile
```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```

**現状**: 両方とも pip を直接使用しており、要変更

### CI/CD での pip/requirements.txt 使用箇所

#### `.github/workflows/terraform-ci.yml`
- **行 9**: `lambda/**/requirements.txt` をトリガーパスとして監視
- このファイルの変更で PR を自動的に plan・scan・validate する

**影響**: 
- `pyproject.toml` への移行後も terraform-ci.yml を更新し、`lambda/**/pyproject.toml` も監視対象に追加すること

#### `.github/workflows/test.yml`
- **現状**: Node.js と npm に限定（フロントエンド向け）
- **Lambda テスト**: 対象外
- **アクション**: Python テスト自動実行の追加を検討可能（現在は手動実行）

#### `.github/workflows/terraform-apply.yml`
- **現状**: Docker ビルド時に `docker build lambda/api/` と `docker build lambda/poller/` を実行
- **pip/requirements への直接参照なし**: Dockerfile 経由なため、Dockerfile を更新すれば対応

---

## 影響範囲

### 変更が必要なファイル一覧

#### 既存ファイル（変更）
1. **`lambda/api/pyproject.toml`** 
   - 既に存在しているが、uv の `dependency-groups` 構文が古い可能性（要確認と統一）

2. **`lambda/poller/Dockerfile`** 
   - `RUN pip install ...` → `RUN uv pip install ...` に変更
   - または uv sync を使用する新しいパターンを採用

3. **`lambda/api/Dockerfile`** 
   - `RUN pip install ...` → `RUN uv pip install ...` に変更
   - または uv sync を使用する新しいパターンを採用

4. **`.github/workflows/terraform-ci.yml`** 
   - トリガーパスに `lambda/**/pyproject.toml` を追加（line 9）

5. **`.gitignore`**
   - `lambda/**/.venv/` または `lambda/**/.uv/` を追加（uv キャッシュ対応）

#### 新規ファイル（作成）
1. **`lambda/poller/pyproject.toml`**
   - `lambda/api/pyproject.toml` と同じ構造で作成

---

## 設計上の判断ポイント

### 1. pyproject.toml の配置：個別 vs ワークスペース

#### 選択肢 A: 個別配置（現在の `lambda/api` パターン）
```
lambda/
├── api/
│   ├── pyproject.toml       <- api 用
│   ├── Dockerfile
│   └── ...
└── poller/
    ├── pyproject.toml       <- poller 用（新規作成）
    ├── Dockerfile
    └── ...
```

**メリット**:
- 各 Lambda の依存関係が完全に独立
- デプロイ時に必要な依存のみをコンテナに含める（イメージサイズ最小化）
- CI/CD での個別トリガー・ビルドが明確
- 同じプロジェクト内の複数パッケージとして管理可能

**デメリット**:
- pyproject.toml が 2 つ存在し、内容の重複が発生する可能性
- バージョン管理（pytest, boto3 など共通依存）が分散

#### 選択肢 B: ワークスペース配置
```
lambda/
├── pyproject.toml           <- ワークスペース定義
├── api/
│   └── pyproject.toml       <- api パッケージ定義（簡略）
└── poller/
    └── pyproject.toml       <- poller パッケージ定義（簡略）
```

**メリット**:
- ルートレベルで全 Lambda の依存を統一管理
- pytest, boto3 などの共通依存バージョンを一元化
- `uv sync --all-groups` で全 Lambda のテスト環境セットアップ可能

**デメリット**:
- Lambda コンテナビルド時にワークスペース全体をコピーする必要がある
- Docker イメージサイズが増加（api ビルド時に poller の依存も含まれる可能性）
- Dockerfile が複雑化（`--directory` オプン使用など）

#### **推奨**: 選択肢 A（個別配置）
理由：
- Lambda は独立したコンテナ/関数として機能
- ECR イメージサイズを最小化（重要：Lambda コンテナの冷起動時間に影響）
- 現状 `lambda/api/pyproject.toml` が既に個別配置されているため、一貫性を維持

---

### 2. Dockerfile での uv の使い方

#### 選択肢 A: `uv pip install` 使用（従来の pip との互換性重視）
```dockerfile
FROM public.ecr.aws/lambda/python:3.11
WORKDIR ${LAMBDA_TASK_ROOT}
COPY pyproject.toml .
RUN uv pip install .
COPY . .
CMD ["lambda_function.lambda_handler"]
```

**特徴**:
- pip のコマンドラインオプション（`--no-cache-dir` など）をそのまま使用可能
- 既存 pip スクリプトの最小変更で移行可能
- ただし uv の高速化メリットが限定的（pip の薄いラッパー）

#### 選択肢 B: `uv sync` 使用（uv ネイティブ、推奨）
```dockerfile
FROM public.ecr.aws/lambda/python:3.11
WORKDIR ${LAMBDA_TASK_ROOT}
COPY pyproject.toml uv.lock .
RUN uv sync --frozen --no-dev
COPY . .
CMD ["lambda_function.lambda_handler"]
```

**特徴**:
- `uv.lock` で完全に再現可能なビルド（本番環境で重要）
- 高速インストール（uv の並列ダウンロード・インストール）
- 開発依存を除外可能（`--no-dev` オプション）
- ローカル開発時も `uv sync` で同じ環境を再現可能

**注意点**:
- `uv.lock` をリポジトリに commit する必要がある
- PR ごとに lock ファイルが更新される可能性（レビュー負荷増）

#### **推奨**: 選択肢 B（`uv sync` + `uv.lock`）
理由：
- 本番環境での再現性が最高
- ECR イメージビルド時の速度向上
- 開発環境（local）と本番（Docker）で同じ依存が保証される

---

### 3. ローカル開発ワークフロー

#### パターン A: ワークディレクトリごとに uv 初期化
```bash
# lambda/api で作業する場合
cd lambda/api
uv venv
uv sync  # pyproject.toml から仮想環境に同期

# lambda/poller で作業する場合
cd lambda/poller
uv venv
uv sync
```

**メリット**:
- 各 Lambda が完全に独立した環境
- テスト実行・デバッグが個別に可能

**デメリット**:
- venv × 2 管理が必要
- ディスク容量消費（各 Lambda で依存がダウンロード・インストール）

#### パターン B: ワークスペース管理（仮にワークスペース構成にした場合）
```bash
# lambda ルートで一度だけ初期化
cd lambda
uv venv
uv sync --all-groups

# どちらのテストも実行可能
pytest api/tests
pytest poller/tests
```

**メリット**:
- 共有 venv で効率的
- 一度の `uv sync` で全セットアップ

**デメリット**:
- 個別ディレクトリのセットアップが複雑

#### **推奨**: パターン A（個別管理）
理由：
- 個別配置を選んだため、自然な選択
- CI/CD（Docker ビルド）とローカル開発の一貫性

---

## リスクと制約

### リスク 1: Docker ビルド時の uv インストール

**問題**: Lambda ベースイメージ（`public.ecr.aws/lambda/python:3.11`）に uv がプリインストールされていない

**対策**:
```dockerfile
FROM public.ecr.aws/lambda/python:3.11
RUN pip install uv  # または: apt-get install uv (Linux)
WORKDIR ${LAMBDA_TASK_ROOT}
COPY pyproject.toml .
RUN uv sync --frozen --no-dev
```

**影響**: Docker イメージビルド時間がわずかに増加（uv インストール分）

### リスク 2: `uv.lock` の管理

**問題**: `uv.lock` ファイルを commit・manage する必要がある

**対策**:
- `uv.lock` を `.gitignore` に追加しない（commit する）
- PR レビュー時に lock ファイル変更を確認
- `--frozen` オプションで意図しないバージョン更新を防止

**影響**: PR ごとに lock ファイルが更新される（レビュー範囲拡大）

### リスク 3: CI/CD ワークフロー更新漏れ

**問題**: `.github/workflows/terraform-ci.yml` の トリガーパスを更新しないと、`pyproject.toml` の変更が CI を起動しない

**対策**: トリガーパスを以下に変更
```yaml
paths:
  - 'terraform/**/*.tf'
  - 'terraform/**/*.hcl'
  - 'lambda/**/*.py'
  - 'lambda/**/pyproject.toml'  # 追加
  - 'lambda/**/uv.lock'         # 追加
  - 'lambda/**/Dockerfile'
```

### リスク 4: 依存関係の不一致（api と poller で異なるバージョン）

**問題**: `lambda/api/pyproject.toml` と `lambda/poller/pyproject.toml` で boto3 のバージョンが異なる場合、テストや本番で不具合が生じる可能性

**対策**:
- 共通依存（boto3 など）はバージョン制約を統一
- `lambda/` ルートに共通の「推奨バージョン」ドキュメント作成を検討

---

## 参考

### 既存実装

#### pyproject.toml（`lambda/api`）
- ファイルパス: `lambda/api/pyproject.toml`
- 構成: `[project]`、`[dependency-groups]`、`[build-system]`
- 注記: `hatchling` をビルドバックエンドとして使用

#### Dockerfile（`lambda/api` と `lambda/poller`）
- ファイルパス: 
  - `lambda/api/Dockerfile`
  - `lambda/poller/Dockerfile`
- 共通: `public.ecr.aws/lambda/python:3.11` ベース、`pip install -r requirements.txt`

#### CI/CD ワークフロー
- `/.github/workflows/terraform-apply.yml` - Docker ビルド・ECR プッシュ（手動トリガー）
- `/.github/workflows/terraform-ci.yml` - PR 検証、plan・format・validate・scan（トリガーパス: `lambda/**/requirements.txt`）

### テスト実行パターン

#### lambda/api テスト
```bash
cd lambda/api
uv venv
uv sync
pytest tests/
```

#### lambda/poller テスト
```bash
cd lambda/poller
uv venv
uv sync
pytest tests/
```

### Docker イメージビルド

#### 現在（pip）
```bash
docker build --platform linux/amd64 -t {ECR}/{REPO}:latest lambda/api/
docker build --platform linux/amd64 -t {ECR}/{REPO}:latest lambda/poller/
```

#### 移行後（uv）
```bash
docker build --platform linux/amd64 -t {ECR}/{REPO}:latest lambda/api/
docker build --platform linux/amd64 -t {ECR}/{REPO}:latest lambda/poller/
# （Dockerfile が uv 対応に変更されていれば、コマンドは同じ）
```

---

## 外部参照

### uv ドキュメント
- [uv 公式ドキュメント](https://docs.astral.sh/uv/) - インストール、使用方法、pyproject.toml 形式
- [uv.lock について](https://docs.astral.sh/uv/concepts/projects/#lockfile) - lock ファイル仕様、再現性

### プロジェクト内参照
- `ARCHITECTURE.md` - Lambda 実装のアーキテクチャ
- `/docs/exec-plans/completed/lambda-implementation-plan.md` - Lambda 実装計画（requirements.txt 時代）
- `/docs/exec-plans/completed/docker-build-research.md` - Docker ビルドプロセス

---

## 次ステップ（計画段階で決定）

1. **pyproject.toml 配置の確定** - 個別 vs ワークスペース（推奨：個別）
2. **Dockerfile パターンの確定** - `uv sync` vs `uv pip install`（推奨：`uv sync` + `uv.lock`）
3. **CI/CD トリガーパス更新** - terraform-ci.yml の変更範囲確定
4. **ローカル開発ドキュメント** - 新しい uv ワークフローをドキュメント化
5. **段階的実装計画作成** - api → poller の順序で実装を計画
