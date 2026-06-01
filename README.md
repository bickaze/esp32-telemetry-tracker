# esp32-telemetry-tracker

Исходники телеметрии на ESP32.

Пишет логи на SD (CSV): GPS, скорость, ускорения, напряжение с ADS1115.  
Смотреть трек и круги можно в браузере — Wi‑Fi `TRACKER`, адрес `http://192.168.4.1/`.

## Что где лежит

- `firmware/esp32_tracker/esp32_tracker.ino` — прошивка для Arduino IDE
- `web/` — html, css, js (отдельно для удобства; в .ino всё уже вшито в PROGMEM)

## Прошивка

1. Плата ESP32 Dev Module  
2. Поставить TinyGPSPlus, Adafruit ADXL345, Adafruit ADS1X15  
3. Открыть `esp32_tracker.ino` и залить  
4. Подключиться к Wi‑Fi TRACKER (пароль `12345678`)

Распиновка — в `docs/libraries.md`.
