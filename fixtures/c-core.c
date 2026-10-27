#include <stdio.h>

static int triangular(int depth) {
    int local = depth;
    if (depth == 0) {
        return local;
    }
    int tail = triangular(depth - 1); // @bp:recurse-call
    int result = local + tail;
    return result; // @bp:recurse-return
}

static int add_bias(int value) {
    int bias = 3;
    int result = value + bias;
    return result; // @bp:add-return
}

int main(void) {
    int values[3] = {0, 0, 0};
    if (scanf("%d %d %d", &values[0], &values[1], &values[2]) != 3) {
        return 2;
    }
    int *pointer = values + 1;
    int sum = 0;
    for (int i = 0; i < 3; ++i) {
        sum += values[i]; // @bp:loop-body
    }
    int triangle = triangular(3); // @bp:triangle-call
    int adjusted = add_bias(sum); // @bp:add-call
    printf("sum=%d adjusted=%d triangle=%d middle=%d\n", sum, adjusted, triangle, *pointer); // @bp:ready
    return 0;
}
