#include <cstdio>
#include <vector>

static int derive_value(int cycle) {
    int produced = 40 + cycle;
    return produced; // @bp:initializer
}

int main() {
    int total = 0;
    for (int cycle = 0; cycle < 2; ++cycle) {
        std::vector<int> ready = {9, 4}; int current = derive_value(cycle); // @bp:declaration
        total += current + ready[1]; // @bp:written
    }
    std::printf("total=%d\n", total);
    return total == 89 ? 0 : 1;
}
