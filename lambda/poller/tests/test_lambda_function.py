"""
Poller Lambda のユニットテスト
boto3 と requests をモックして、外部依存なしにロジックをテストする
"""
import os
import sys
import json
import pytest
import requests as req_module

# テスト実行時に lambda_function をインポートできるようにパスを追加する
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import lambda_function
from lambda_function import (
    fetch_switchbot_data,
    _fetch_with_retry,
    _validate_sensor_data,
    save_to_dynamodb,
    lambda_handler,
    logger,
)


# ============================================================
# TestFetchSwitchbotData
# ============================================================

class TestFetchSwitchbotData:
    """fetch_switchbot_data() のテスト"""

    def test_fetch_switchbot_data_success(self, mocker):
        """ハッピーパス: API が statusCode 100 とセンサーデータを返す。"""
        mock_response = mocker.Mock()
        mock_response.json.return_value = {
            'statusCode': 100,
            'body': {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        }
        mocker.patch('requests.get', return_value=mock_response)
        result = fetch_switchbot_data('token', 'secret', 'device123')
        assert result == {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}

    def test_fetch_switchbot_data_api_error(self, mocker):
        """Switchbot が非 100 ステータスコードを返す。"""
        mock_response = mocker.Mock()
        mock_response.json.return_value = {'statusCode': 101, 'message': 'Unauthorized'}
        mocker.patch('requests.get', return_value=mock_response)
        with pytest.raises(Exception, match="Switchbot API error"):
            fetch_switchbot_data('token', 'secret', 'device123')

    def test_fetch_switchbot_data_network_error(self, mocker):
        """ネットワークエラーが requests.RequestException を送出する。"""
        mocker.patch('requests.get', side_effect=req_module.RequestException("timeout"))
        with pytest.raises(req_module.RequestException):
            fetch_switchbot_data('token', 'secret', 'device123')

    def test_fetch_switchbot_data_rate_limit(self, mocker):
        """レート制限（statusCode=105）はエラーとして扱われる。"""
        mock_response = mocker.Mock()
        mock_response.json.return_value = {'statusCode': 105, 'message': 'Too Many Requests'}
        mocker.patch('requests.get', return_value=mock_response)
        with pytest.raises(Exception, match="Switchbot API error"):
            fetch_switchbot_data('token', 'secret', 'device123')


# ============================================================
# TestFetchWithRetry
# ============================================================

class TestFetchWithRetry:
    """_fetch_with_retry() のテスト"""

    def test_fetch_with_retry_succeeds_first_attempt(self, mocker):
        """成功時にリトライは不要。"""
        mock_fetch = mocker.patch(
            'lambda_function.fetch_switchbot_data',
            return_value={'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        )
        result = _fetch_with_retry('token', 'secret', 'device123')
        assert mock_fetch.call_count == 1
        assert result == {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}

    def test_fetch_with_retry_succeeds_on_second_attempt(self, mocker):
        """1 回目が失敗し、2 回目が成功する。"""
        success = {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        mocker.patch(
            'lambda_function.fetch_switchbot_data',
            side_effect=[Exception("temporary"), success]
        )
        mocker.patch('time.sleep')  # テストで実際にスリープしない
        result = _fetch_with_retry('token', 'secret', 'device123', base_delay=0)
        assert result == success

    def test_fetch_with_retry_exhausts_all_attempts(self, mocker):
        """3 回すべての試行が失敗し、最後の例外を送出する。"""
        mocker.patch(
            'lambda_function.fetch_switchbot_data',
            side_effect=Exception("persistent failure")
        )
        mocker.patch('time.sleep')
        with pytest.raises(Exception, match="persistent failure"):
            _fetch_with_retry('token', 'secret', 'device123', max_attempts=3, base_delay=0)

    def test_fetch_with_retry_logs_warning_on_failure(self, mocker):
        """失敗した試行が WARNING レベルでログに記録される。"""
        success = {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        mocker.patch(
            'lambda_function.fetch_switchbot_data',
            side_effect=[Exception("temporary"), success]
        )
        mocker.patch('time.sleep')
        mock_warning = mocker.patch.object(logger, 'warning')
        _fetch_with_retry('token', 'secret', 'device123', base_delay=0)
        assert mock_warning.call_count == 1

    def test_fetch_with_retry_call_count(self, mocker):
        """max_attempts 回だけ呼び出されることを確認する。"""
        mock_fetch = mocker.patch(
            'lambda_function.fetch_switchbot_data',
            side_effect=Exception("always fails")
        )
        mocker.patch('time.sleep')
        with pytest.raises(Exception):
            _fetch_with_retry('token', 'secret', 'device123', max_attempts=3, base_delay=0)
        assert mock_fetch.call_count == 3


# ============================================================
# TestValidateSensorData
# ============================================================

class TestValidateSensorData:
    """_validate_sensor_data() のテスト"""

    def test_validate_sensor_data_valid(self):
        """有効なデータは警告なしで通過する。"""
        # 例外を送出しないことを確認する
        _validate_sensor_data(
            {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}, 'device123'
        )

    def test_validate_sensor_data_missing_temperature(self):
        """temperature フィールドの欠如が KeyError を送出する。"""
        with pytest.raises(KeyError, match="temperature"):
            _validate_sensor_data({'humidity': 45.0, 'CO2': 800}, 'device123')

    def test_validate_sensor_data_missing_humidity(self):
        """humidity フィールドの欠如が KeyError を送出する。"""
        with pytest.raises(KeyError, match="humidity"):
            _validate_sensor_data({'temperature': 22.5, 'CO2': 800}, 'device123')

    def test_validate_sensor_data_missing_co2(self):
        """CO2 フィールドの欠如が KeyError を送出する。"""
        with pytest.raises(KeyError, match="CO2"):
            _validate_sensor_data({'temperature': 22.5, 'humidity': 45.0}, 'device123')

    def test_validate_sensor_data_out_of_range_temperature_logs_warning(self, mocker):
        """範囲外の温度は警告をログに記録するが例外を送出しない。"""
        mock_warning = mocker.patch.object(logger, 'warning')
        _validate_sensor_data({'temperature': 200.0, 'humidity': 45.0, 'CO2': 800}, 'device123')
        assert mock_warning.called

    def test_validate_sensor_data_out_of_range_humidity_logs_warning(self, mocker):
        """範囲外の湿度は警告をログに記録するが例外を送出しない。"""
        mock_warning = mocker.patch.object(logger, 'warning')
        _validate_sensor_data({'temperature': 22.5, 'humidity': 150.0, 'CO2': 800}, 'device123')
        assert mock_warning.called

    def test_validate_sensor_data_out_of_range_co2_logs_warning(self, mocker):
        """範囲外の CO2 は警告をログに記録するが例外を送出しない。"""
        mock_warning = mocker.patch.object(logger, 'warning')
        _validate_sensor_data({'temperature': 22.5, 'humidity': 45.0, 'CO2': 99999}, 'device123')
        assert mock_warning.called

    def test_validate_sensor_data_boundary_values_valid(self):
        """境界値（-50, 100 温度など）は有効とみなす。"""
        # 例外も警告も発生しないことを確認する
        _validate_sensor_data({'temperature': -50, 'humidity': 0, 'CO2': 0}, 'device123')
        _validate_sensor_data({'temperature': 100, 'humidity': 100, 'CO2': 10000}, 'device123')


# ============================================================
# TestSaveToDynamoDB
# ============================================================

class TestSaveToDynamoDB:
    """save_to_dynamodb() のテスト"""

    def test_save_to_dynamodb_success(self, mocker):
        """DynamoDB の put_item 呼び出しが成功する。"""
        mock_table = mocker.Mock()
        mock_dynamodb = mocker.patch('lambda_function.dynamodb')
        mock_dynamodb.Table.return_value = mock_table
        sensor_data = {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        save_to_dynamodb('test-table', 'device123', sensor_data)
        mock_table.put_item.assert_called_once()
        call_args = mock_table.put_item.call_args[1]['Item']
        assert call_args['deviceId'] == 'device123'
        assert float(call_args['temperature']) == 22.5
        assert float(call_args['humidity']) == 45.0
        assert call_args['co2'] == 800
        assert 'expiresAt' in call_args
        assert 'timestamp' in call_args

    def test_save_to_dynamodb_dynamodb_error(self, mocker):
        """DynamoDB エラーが伝播する。"""
        mock_table = mocker.Mock()
        mock_table.put_item.side_effect = Exception("DynamoDB error")
        mocker.patch('lambda_function.dynamodb').Table.return_value = mock_table
        with pytest.raises(Exception, match="DynamoDB error"):
            save_to_dynamodb('test-table', 'device123', {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800})

    def test_save_to_dynamodb_ttl_is_30_days(self, mocker):
        """TTL が現在時刻から 30 日後であることを確認する。"""
        import time as time_module
        mock_table = mocker.Mock()
        mocker.patch('lambda_function.dynamodb').Table.return_value = mock_table
        before = int(time_module.time())
        save_to_dynamodb('test-table', 'device123', {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800})
        after = int(time_module.time())
        call_args = mock_table.put_item.call_args[1]['Item']
        expected_min = before + 30 * 24 * 60 * 60
        expected_max = after + 30 * 24 * 60 * 60
        assert expected_min <= call_args['expiresAt'] <= expected_max


# ============================================================
# TestLambdaHandler
# ============================================================

class TestLambdaHandler:
    """lambda_handler() の統合テスト"""

    def test_lambda_handler_success(self, mocker):
        """全体のハッピーパスが statusCode 200 を返す。"""
        mocker.patch.dict(os.environ, {
            'SWITCHBOT_TOKEN': 'tok', 'SWITCHBOT_SECRET': 'sec',
            'DEVICE_ID': 'dev', 'TABLE_NAME': 'tbl'
        })
        mocker.patch(
            'lambda_function._fetch_with_retry',
            return_value={'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        )
        mocker.patch('lambda_function._validate_sensor_data')
        mocker.patch('lambda_function.save_to_dynamodb')
        result = lambda_handler({}, {})
        assert result['statusCode'] == 200

    def test_lambda_handler_missing_env_vars(self, mocker):
        """環境変数の欠如が Switchbot を呼び出さずに statusCode 500 を返す。"""
        mocker.patch.dict(os.environ, {}, clear=True)
        mock_fetch = mocker.patch('lambda_function._fetch_with_retry')
        result = lambda_handler({}, {})
        assert result['statusCode'] == 500
        mock_fetch.assert_not_called()

    def test_lambda_handler_missing_env_vars_body_contains_missing_list(self, mocker):
        """エラーレスポンスボディに欠けている変数名のリストが含まれる。"""
        mocker.patch.dict(os.environ, {}, clear=True)
        result = lambda_handler({}, {})
        body = json.loads(result['body'])
        assert 'missing' in body
        assert len(body['missing']) > 0

    def test_lambda_handler_api_failure_returns_500(self, mocker):
        """リトライ後の Switchbot API 障害が statusCode 500 を返す。"""
        mocker.patch.dict(os.environ, {
            'SWITCHBOT_TOKEN': 'tok', 'SWITCHBOT_SECRET': 'sec',
            'DEVICE_ID': 'dev', 'TABLE_NAME': 'tbl'
        })
        mocker.patch(
            'lambda_function._fetch_with_retry',
            side_effect=Exception("all retries failed")
        )
        result = lambda_handler({}, {})
        assert result['statusCode'] == 500

    def test_lambda_handler_dynamodb_error_returns_500(self, mocker):
        """DynamoDB 保存エラーが statusCode 500 を返す。"""
        mocker.patch.dict(os.environ, {
            'SWITCHBOT_TOKEN': 'tok', 'SWITCHBOT_SECRET': 'sec',
            'DEVICE_ID': 'dev', 'TABLE_NAME': 'tbl'
        })
        mocker.patch(
            'lambda_function._fetch_with_retry',
            return_value={'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
        )
        mocker.patch('lambda_function._validate_sensor_data')
        mocker.patch('lambda_function.save_to_dynamodb', side_effect=Exception("DynamoDB error"))
        result = lambda_handler({}, {})
        assert result['statusCode'] == 500

    def test_lambda_handler_partial_env_vars_returns_500(self, mocker):
        """一部の環境変数が欠けている場合も statusCode 500 を返す。"""
        mocker.patch.dict(os.environ, {'SWITCHBOT_TOKEN': 'tok'}, clear=True)
        mock_fetch = mocker.patch('lambda_function._fetch_with_retry')
        result = lambda_handler({}, {})
        assert result['statusCode'] == 500
        mock_fetch.assert_not_called()
