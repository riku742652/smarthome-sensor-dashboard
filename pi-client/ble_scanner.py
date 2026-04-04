"""
SwitchBot CO2センサー BLE スキャナー
BLE アドバタイズメントを受信し、センサーデータを Lambda API に POST する
"""
import asyncio
import logging
import os
import sys

import httpx
from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# SwitchBot のメーカー ID（0x0969 = 2409）
SWITCHBOT_COMPANY_ID = 0x0969


def parse_co2_sensor(mfr_data: bytes) -> dict | None:
    """
    SwitchBot CO2センサーのメーカーデータをパースする。

    メーカーデータのレイアウト（16 バイト）:
      byte  8    : 温度の小数部 (下位 4 ビット, 0.1°C 単位)
      byte  9    : 温度の整数部 (下位 7 ビット) + 符号フラグ (bit7: 1=正, 0=負)
      byte  10   : 湿度 (下位 7 ビット, %)
      bytes 13-14: CO2 濃度 (big-endian uint16, ppm)

    パースできない場合は None を返す。
    """
    if len(mfr_data) < 15:
        return None

    temp_decimal = mfr_data[8] & 0x0F
    temp_integer = mfr_data[9] & 0x7F
    is_positive = (mfr_data[9] & 0x80) > 0
    temperature = temp_integer + (temp_decimal * 0.1)
    if not is_positive:
        temperature = -temperature
    temperature = round(temperature, 1)

    humidity = mfr_data[10] & 0x7F
    co2 = int.from_bytes(mfr_data[13:15], byteorder="big")

    return {
        "temperature": temperature,
        "humidity": humidity,
        "co2": co2,
    }


async def post_sensor_data(
    client: httpx.AsyncClient,
    api_url: str,
    api_key: str,
    device_id: str,
    data: dict,
) -> None:
    """センサーデータを Lambda API に POST する"""
    payload = {"deviceId": device_id, **data}
    resp = await client.post(
        f"{api_url}/data",
        json=payload,
        headers={"X-Api-Key": api_key},
        timeout=10,
    )
    resp.raise_for_status()
    logger.info(
        "POST /data success: temp=%.1f hum=%d co2=%d",
        data["temperature"],
        data["humidity"],
        data["co2"],
    )


async def scan_once(
    scan_duration: float = 5.0,
    device_mac: str | None = None,
) -> dict | None:
    """
    BLE をスキャンして SwitchBot CO2センサーのデータを 1 件取得する。

    device_mac が指定されている場合は、その MAC アドレスのデバイスのみを対象とする。
    scan_duration 秒以内にデータが見つからない場合は None を返す。
    """
    result: dict | None = None

    def callback(device: BLEDevice, adv: AdvertisementData) -> None:
        nonlocal result
        if result is not None:
            return  # すでに取得済み
        if device_mac and device.address.upper() != device_mac.upper():
            return  # 対象デバイス以外はスキップ
        mfr = adv.manufacturer_data.get(SWITCHBOT_COMPANY_ID)
        if mfr is None:
            return
        parsed = parse_co2_sensor(mfr)
        if parsed is not None:
            logger.debug("BLE data from %s: %s", device.address, parsed)
            result = parsed

    async with BleakScanner(callback):
        await asyncio.sleep(scan_duration)

    return result


async def main() -> None:
    """メインループ: スキャン → POST を繰り返す"""
    api_url = os.environ.get("API_URL", "").rstrip("/")
    api_key = os.environ.get("API_KEY", "")
    device_id = os.environ.get("DEVICE_ID", "")

    if not all([api_url, api_key, device_id]):
        logger.error(
            "Missing required environment variables: API_URL, API_KEY, or DEVICE_ID"
        )
        sys.exit(1)

    # BLE MAC アドレスによるフィルタリング（任意）
    # 複数の SwitchBot デバイスが存在する環境では DEVICE_MAC を設定することを推奨
    device_mac: str | None = os.environ.get("DEVICE_MAC") or None

    scan_interval = int(os.environ.get("SCAN_INTERVAL", "60"))
    scan_duration = float(os.environ.get("SCAN_DURATION", "5"))

    logger.info(
        "Starting BLE scanner: device_id=%s device_mac=%s"
        " interval=%ds scan=%.0fs",
        device_id,
        device_mac or "any",
        scan_interval,
        scan_duration,
    )

    async with httpx.AsyncClient() as http_client:
        while True:
            try:
                data = await scan_once(scan_duration, device_mac)
                if data is None:
                    logger.warning(
                        "No SwitchBot CO2 sensor data found in scan window"
                    )
                else:
                    await post_sensor_data(
                        http_client, api_url, api_key, device_id, data
                    )
            except httpx.HTTPStatusError as e:
                logger.error(
                    "API error: %s %s", e.response.status_code, e.response.text
                )
            except Exception:
                logger.exception("Unexpected error")

            await asyncio.sleep(scan_interval)


if __name__ == "__main__":
    asyncio.run(main())
