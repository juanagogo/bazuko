#pragma once
// Escritor y lector de bits para los paquetes de red: valores enteros de N bits, booleanos, flotantes cuantizados en un rango y cadenas cortas.
// No depende del juego ni de ninguna biblioteca de red. El lector nunca se sale del buffer: si faltan datos marca `Failed()` y devuelve ceros.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace Bazuko::Net {

class BitWriter {
public:
    void Bits(uint32_t value, int count) {   // los `count` bits bajos de `value`, de 1 a 32
        for (int i = count - 1; i >= 0; --i) {
            if (m_BitPosition == 0) m_Bytes.push_back(0);
            if ((value >> i) & 1u) m_Bytes.back() |= static_cast<uint8_t>(1u << (7 - m_BitPosition));
            m_BitPosition = (m_BitPosition + 1) & 7;
        }
    }
    void Bool(bool value) { Bits(value ? 1u : 0u, 1); }
    void U8(uint32_t value) { Bits(value & 0xFFu, 8); }
    void U16(uint32_t value) { Bits(value & 0xFFFFu, 16); }
    void U32(uint32_t value) { Bits(value, 32); }
    // Flotante en [min, max] con `bits` bits: error maximo (max-min) / (2^bits - 1) / 2
    void Quantized(float value, float minimum, float maximum, int bits) { Bits(Quantize(value, minimum, maximum, bits), bits); }
    void String(const std::string& text, size_t maxLength = 32) {   // longitud (8 bits) y bytes; se corta a `maxLength`
        const size_t length = std::min({text.size(), maxLength, static_cast<size_t>(255)});
        U8(static_cast<uint32_t>(length));
        for (size_t i = 0; i < length; ++i) U8(static_cast<uint8_t>(text[i]));
    }
    void Align() { m_BitPosition = 0; }   // el siguiente valor empieza en un byte nuevo
    const std::vector<uint8_t>& Data() const { return m_Bytes; }
    size_t Size() const { return m_Bytes.size(); }

    static uint32_t Quantize(float value, float minimum, float maximum, int bits) {
        const uint32_t top = bits >= 32 ? 0xFFFFFFFFu : (1u << bits) - 1u;
        const float t = std::clamp((value - minimum) / (maximum - minimum), 0.0f, 1.0f);
        return static_cast<uint32_t>(std::lround(static_cast<double>(t) * top));
    }

private:
    std::vector<uint8_t> m_Bytes;
    int m_BitPosition = 0;   // bit libre dentro del ultimo byte (0 = byte completo)
};

class BitReader {
public:
    BitReader(const uint8_t* data, size_t size) : m_Data(data), m_Size(size) {}
    explicit BitReader(const std::vector<uint8_t>& bytes) : BitReader(bytes.data(), bytes.size()) {}

    uint32_t Bits(int count) {
        uint32_t value = 0;
        for (int i = 0; i < count; ++i) {
            if (m_BytePosition >= m_Size) { m_Failed = true; return 0; }
            value = (value << 1) | ((m_Data[m_BytePosition] >> (7 - m_BitPosition)) & 1u);
            if (++m_BitPosition == 8) { m_BitPosition = 0; ++m_BytePosition; }
        }
        return value;
    }
    bool Bool() { return Bits(1) != 0; }
    uint32_t U8() { return Bits(8); }
    uint32_t U16() { return Bits(16); }
    uint32_t U32() { return Bits(32); }
    float Quantized(float minimum, float maximum, int bits) {
        const uint32_t top = bits >= 32 ? 0xFFFFFFFFu : (1u << bits) - 1u;
        return minimum + (maximum - minimum) * static_cast<float>(static_cast<double>(Bits(bits)) / top);
    }
    std::string String(size_t maxLength = 32) {
        const size_t length = U8();
        if (length > maxLength) { m_Failed = true; return {}; }
        std::string text;
        for (size_t i = 0; i < length && !m_Failed; ++i) text.push_back(static_cast<char>(U8()));
        return m_Failed ? std::string{} : text;
    }
    void Align() { if (m_BitPosition != 0) { m_BitPosition = 0; ++m_BytePosition; } }
    bool Failed() const { return m_Failed; }

private:
    const uint8_t* m_Data;
    size_t m_Size;
    size_t m_BytePosition = 0;
    int m_BitPosition = 0;
    bool m_Failed = false;
};

} // namespace Bazuko::Net
