#include <cstdio>

static int derive_value(int cycle) {
    int produced = 40 + cycle;
    return produced; // @bp:initializer
}

int main() {
    int total = 0;
    for (int cycle = 0; cycle < 2; ++cycle) {
        int current = derive_value(cycle); // @bp:declaration
        total += current; // @bp:written
    }
    std::printf("total=%d\n", total);
    return total == 81 ? 0 : 1;
}
