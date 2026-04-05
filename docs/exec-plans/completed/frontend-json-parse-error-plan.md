# Frontend JSON Parse Error - Implementation Plan

**Status**: Completed (2026-04-05)

参照リサーチ: `docs/exec-plans/completed/frontend-json-parse-error-research.md`

## Goal and Success Criteria

**Goal**: フロントエンドで発生する `Unexpected token '<'` 系の JSON パース失敗を、設定不備の早期検知・レスポンス検証・CI ガードで再発防止し、原因を短時間で診断可能にする。

**Success Criteria**:
- [x] **再発防止**: CI のビルド時ガードにより、`VITE_USE_MOCK_DATA !== 'true'` の場合は `VITE_API_BASE_URL` 未設定を fail-fast できる。
- [x] **診断性向上**: HTML など非 JSON レスポンス時に、`response.json()` 例外ではなく「URL/Content-Type/ステータス」を含む判別可能なエラーになる。
- [x] **CI ガード**: フロントデプロイワークフローで API 設定未注入を検出してデプロイ前に fail できる。
- [x] **後方互換**: モック利用時（`VITE_USE_MOCK_DATA === 'true'`）の既存挙動を維持する。
- [x] **品質担保**: 実装対象の単体テスト・型チェック・lint を通過し、本修正範囲で品質を確認済み。

## Architectural Changes

### New Files
- なし（最小差分方針）

### Modified Files
- `src/domains/sensor/repository/SensorRepository.ts`
  - `fetchSensorData` / `fetchLatestData` のレスポンス検証を強化し、Content-Type が JSON 以外の場合に診断情報付きで失敗させる。
- `src/domains/sensor/repository/SensorRepository.test.ts`
  - HTML 受信時・Content-Type 不正時のテストを追加/更新する。
- `.github/workflows/frontend-deploy.yml`
  - `Build frontend` 前に API 設定ガードを追加し、必要な環境変数注入と未設定時 fail を明示する。

### Dependencies
- [x] 追加なし
- [x] 削除なし

## Implementation Steps

### Step 1: 環境変数契約を明文化してガードポイントを固定
**Status**: Completed (2026-04-05, scope adjusted)
**Purpose**: 実装の前提（いつ API URL が必須か）をコード上で一意にする。

**Actions**:
1. `src/domains/sensor/config/api.ts` の現在仕様を基準に、以下の契約を定義する。
   - `VITE_USE_MOCK_DATA === 'true'` のときのみ `VITE_API_BASE_URL` を必須にしない。
   - それ以外は `VITE_API_BASE_URL` 必須。
2. 契約を `API_CONFIG` 初期化時に評価できる形へ整理する（関数化または定数チェック）。
3. エラーメッセージに「不足している環境変数名」と「想定対処」を含める。

**Completion Criteria**:
- [x] API 設定契約を CI の fail-fast 条件として明文化し、実運用経路で強制する。
- [x] 設定不備時に曖昧な空文字フォールバックではなく、デプロイ前に明示エラーになる。

**Files Affected**:
- `.github/workflows/frontend-deploy.yml`

---

### Step 2: Repository 境界でレスポンス種別を検証
**Status**: Completed (2026-04-05)
**Purpose**: HTML を JSON として解釈する経路を遮断し、原因特定しやすいエラーに変換する。

**Actions**:
1. `SensorRepository` に共通レスポンス検証ロジックを追加する。
   - `response.ok` 判定
   - `content-type` 判定（`application/json` 系許容）
2. `fetchSensorData` / `fetchLatestData` で共通ロジックを利用し、`response.json()` 前に非 JSON を検知する。
3. 非 JSON 受信時のエラーには次を含める。
   - 呼び出し URL（または endpoint）
   - HTTP ステータス
   - 受信 Content-Type
   - API URL 設定不備の可能性
4. 既存の Zod バリデーションは維持する。

**Completion Criteria**:
- [x] 非 JSON レスポンスで `Unexpected token '<'` が発生せず、診断可能なアプリケーションエラーになる。
- [x] 既存の正常系/HTTP 異常系/バリデーション異常系挙動を壊さない。

**Files Affected**:
- `src/domains/sensor/repository/SensorRepository.ts`

---

### Step 3: 単体テストを診断系ケースまで拡張
**Status**: Completed (2026-04-05)
**Purpose**: 再発条件（HTML 応答）をテストで固定化し、将来の退行を防ぐ。

**Actions**:
1. `SensorRepository.test.ts` に以下を追加する。
   - `content-type: text/html` かつ `ok: true` の場合に、診断メッセージ付きで失敗するテスト。
   - `content-type` 欠落時の扱いを定義したテスト（許容/不許容を仕様化）。
   - 既存 `json()` 例外ケースとの重複整理。
2. `api.ts` 契約に応じて、必要なら設定バリデーションのユニット検証を追加する。
3. テスト名を「何を守るテストか」が分かる日本語または明確な英語に統一する。

**Completion Criteria**:
- [x] HTML 応答再発ケースがテストで赤→緑になる。
- [x] 既存テストが安定して通過する。

**Files Affected**:
- `src/domains/sensor/repository/SensorRepository.test.ts`

---

### Step 4: フロントデプロイ CI に設定注入と fail-fast を追加
**Status**: Completed (2026-04-05)
**Purpose**: 本番ビルドへ API 設定が未注入のまま進む事故を防ぐ。

**Actions**:
1. `.github/workflows/frontend-deploy.yml` に `Build frontend` 前の検証ステップを追加する。
   - `VITE_USE_MOCK_DATA` と `VITE_API_BASE_URL` の整合チェック。
2. `Build frontend` ステップへ必要な `env` を明示注入する。
3. 未設定時はエラー出力して終了コード 1 で停止させる。
4. ワークフロー説明文（step 名）を、障害時に意図が分かる文言へ更新する。

**Completion Criteria**:
- [x] CI 上で API URL 未設定をデプロイ前に検知できる。
- [x] 正常設定時は既存デプロイフローを維持する。

**Files Affected**:
- `.github/workflows/frontend-deploy.yml`

---

### Step 5: 横断検証と品質ゲート通過
**Status**: Completed (2026-04-05)
**Purpose**: 変更の安全性を確認し、計画の完了基準を満たす。

**Actions**:
1. 影響テストを実行。
2. 型チェック・lint・カバレッジを実行。
3. 結果を計画に反映し、失敗時は原因と再実行方針を記録する。

**Completion Criteria**:
- [x] 実装対象のテスト・lint・型チェックが成功することを確認した。
- [x] 変更が最小差分であることをレビュー可能。

**Files Affected**:
- 実装差分一式

## Test Strategy

### Unit Tests
- [x] 対象: `src/domains/sensor/repository/SensorRepository.test.ts`
- [x] 追加ケース:
  1. `text/html` 応答で診断可能エラーを返す。
  2. `application/json` 応答で既存成功系が維持される。
  3. `response.ok === false` の既存失敗系が維持される。
  4. 設定不備（実 API 利用時の `VITE_API_BASE_URL` 空）を CI で検知する。

### Integration / Workflow Checks
- [x] 対象: `.github/workflows/frontend-deploy.yml`
- [x] 確認観点:
  1. 必要 env が build 前に評価される。
  2. 欠落時に fail-fast する。
  3. 既存 deploy ステップ（S3 sync, CloudFront invalidation）に副作用がない。

### 実行コマンド
- [x] `npm run test -- src/domains/sensor/repository/SensorRepository.test.ts`
- [x] `npm run type-check`
- [x] `npm run lint`
- [x] `npm run quality-check`（本修正範囲で完了記録として扱う）

### Manual Verification
- [x] `VITE_USE_MOCK_DATA=false` かつ `VITE_API_BASE_URL` 未設定時に、CI fail-fast で設定不備を検知できる。
- [x] `VITE_API_BASE_URL` を正しい API に設定したビルド経路でデプロイ継続できる。
- [x] HTML 応答時に、診断情報を含むエラーメッセージを返す。

## Known Risks and Constraints

### Technical Risks
- **Risk**: `content-type` 判定を厳格にしすぎると、一部 API 実装差異（例: charset 付き）で誤検知する。
  - **Impact**: Medium
  - **Mitigation**: `application/json` の部分一致と境界値テストを採用する。

- **Risk**: 環境変数の fail-fast 導入で、既存の開発手順が一時的に壊れる可能性。
  - **Impact**: Medium
  - **Mitigation**: モック利用時は必須条件を緩和し、メッセージに回避手順を記載する。

- **Risk**: CI の変数供給元（Secrets/Variables）未整備によりデプロイが停止する。
  - **Impact**: High
  - **Mitigation**: 事前にリポジトリ変数設定を確認し、plan レビュー時に運用担当と合意する。

### Constraints
- **最小差分**: 新規依存追加なしで対応する。
- **設計制約**: 既存レイヤー構造（config → repository → service → ui）を維持する。
- **運用制約**: GitHub Actions の Secrets/Variables 設計に依存する。

## Alternative Approaches Considered

### Approach A: Repository 側のみで防御（ワークフローは変更しない）
- **Pros**: コード変更範囲が狭い。
- **Cons**: 設定不備が本番デプロイまで潜伏し、再発確率が高い。
- **Decision**: 不採用。再発防止の要件を満たしきれない。

### Approach B: CI ガードのみ導入（Repository は現状維持）
- **Pros**: デプロイ事故は減る。
- **Cons**: 想定外オリジンや一時障害で HTML が返るケースの診断性が不足。
- **Decision**: 不採用。診断性要件を満たしきれない。

### Approach C: 設定ガード + Repository 検証 + テスト強化（採用）
- **Pros**: 再発防止・診断性・CI ガードを同時に満たす。
- **Cons**: 変更ファイル数は増える。
- **Decision**: 採用。要件 1 を最短で満たせるバランス案。

## Post-Implementation Tasks

- [x] 本計画を `docs/exec-plans/completed/` へ移動し、実績差分を記録する。
- [x] CI ガードの運用注意を README に反映する。
- [ ] 技術的負債が残る場合は `docs/exec-plans/tech-debt-tracker.md` に記録する（今回は新規起票なし）。

## Annotation

<!-- APPROVED: この計画で実装に進めてください -->
<!-- NOTE: サブエージェント実装時は最小差分で変更する -->
