"""
SwitchBot CO2センサー BLE スキャナー
BLE アドバタイズメントを受信し、センサーデータを Lambda API に POST する
"""
import asyncio
import logging
import os
import struct
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
      bytes 8-9  : 温度 (little-endian uint16, 単位 0.1°C)
      byte  10   : 湿度 (%)
      bytes 13-14: CO2 濃度 (little-endian uint16, ppm)

    パースできない場合は None を返す。
    """
    if len(mfr_data) < 15:
        return None

    temp_raw = struct.unpack_from("<H", mfr_data, 8)[0]
    temperature = round(temp_raw / 10.0, 1)
    humidity = mfr_data[10]
    co2 = struct.unpack_from("<H", mfr_data, 13)[0]

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
    logger.info("POST /data success: temp=%.1f hum=%d co2=%d", data["temperature"], data["humidity"], data["co2"])


async def scan_once(scan_duration: float = 5.0) -> dict | None:
    """
    BLE をスキャンして SwitchBot CO2センサーのデータを 1 件取得する。
    scan_duration 秒以内にデータが見つからない場合は None を返す。
    """
    result: dict | None = None

    def callback(device: BLEDevice, adv: AdvertisementData) -> None:
        nonlocal result
        if result is not None:
            return  # すでに取得済み
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
    api_url = os.environ["API_URL"].rstrip("/")
    api_key = os.environ["API_KEY"]
    device_id = os.environ["DEVICE_ID"]
    scan_interval = int(os.environ.get("SCAN_INTERVAL", "60"))
    scan_duration = float(os.environ.get("SCAN_DURATION", "5"))

    logger.info(
        "Starting BLE scanner: device_id=%s interval=%ds scan=%.0fs",
        device_id,
        scan_interval,
        scan_duration,
    )

    async with httpx.AsyncClient() as http_client:
        while True:
            try:
                data = await scan_once(scan_duration)
                if data is None:
                    logger.warning("No SwitchBot CO2 sensor data found in scan window")
                else:
                    await post_sensor_data(http_client, api_url, api_key, device_id, data)
            except httpx.HTTPStatusError as e:
                logger.error("API error: %s %s", e.response.status_code, e.response.text)
            except Exception:
                logger.exception("Unexpected error")

            await asyncio.sleep(scan_interval)


if __name__ == "__main__":
    asyncio.run(main())
