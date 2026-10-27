#include <cstdio>
#include <string>
#include <vector>

int adjust(int value) {
    int shifted = value + 4;
    return shifted;
}

int sumdown(int n) {
    if (n == 0) return 0;
    int tail = sumdown(n - 1);
    return n + tail;
}

int main() {
    int seed = 0;
    std::scanf("%d", &seed);
    int numbers[3] = {seed, seed + 1, seed + 2};
    int *cursor = numbers + 1;
    std::vector<int> items = {6, 2, 7};
    std::string label = "independent-五号";
    int transformed = adjust(seed);
    int recurrence = sumdown(3);
    std::printf("ui05=%d middle=%d vec=%d recurrence=%d\n", transformed, *cursor, items[2], recurrence);
    return 0;
}
// person05 fresh-ui-v030-20261025-A
