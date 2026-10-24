#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>

int sum(const int *values, int n) {
    if (n == 0) return 0;
    return values[n - 1] + sum(values, n - 1);
}

int main(void) {
    int values[4] = {0};
    for (int i = 0; i < 4; ++i) {
        if (scanf("%d", &values[i]) != 1) return 2;
    }
    int *first = &values[0];
    int64_t large = INT64_C(9223372036854775806);
    printf("sum=%d first=%d int64=%" PRId64 "\n", sum(values, 4), *first, large);
    return 0;
}
