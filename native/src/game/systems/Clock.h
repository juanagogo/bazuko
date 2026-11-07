#pragma once

namespace bazuko {

// Reloj del juego: un día completo dura `dayLengthSeconds` reales (3600 en el juego).
class Clock {
public:
    explicit Clock(double dayLengthSeconds) : minutesPerSecond_(24.0 * 60.0 / dayLengthSeconds) {}

    void update(double dt) {
        hour += dt * minutesPerSecond_ / 60.0;
        while (hour >= 24) { hour -= 24; ++day; }
    }
    // Avanza `hours` horas de golpe (dormir).
    void advance(double hours) {
        hour += hours;
        while (hour >= 24) { hour -= 24; ++day; }
    }
    bool isNight() const { return hour < 6 || hour >= 20; }

    int day = 1;
    double hour = 6;  // empieza de madrugada

private:
    double minutesPerSecond_;
};

}  // namespace bazuko
