#include <cstdio>
#include <string>
#include <vector>

static int twice(int value) {
    int doubled = value * 2;
    return doubled; // @bp:twice-return
}

static int recurse(int depth) {
    int token = 10 + depth;
    if (depth == 0) {
        return token;
    }
    int nested = recurse(depth - 1); // @bp:recurse-call
    return token + nested; // @bp:recurse-return
}

int main() {
    int seed = 0;
    if (std::scanf("%d", &seed) != 1) {
        return 2;
    }
    int raw[3] = {seed, seed + 2, seed + 5};
    int *pointer = raw + 1;
    std::vector<int> values = {3, 1};
    values.reserve(2);
    values.push_back(8);
    values[0] = 7;
    std::string empty;
    std::string shortText = "pad";
    std::string longText(48, 'x');
    std::string utf8 = u8"中文😀";
    int shadow = 5;
    int doubled = twice(seed); // @bp:step-call
    int recurrence = recurse(2); // @bp:main-recurse-call
    int loopTotal = 0;
    for (int i = 0; i < 3; ++i) {
        loopTotal += raw[i]; // @bp:loop-body
    }
    {
        int shadow = 17;
        int innerSeen = shadow + loopTotal;
        loopTotal += shadow; // @bp:shadow-inner
    }
    int marker = twice(loopTotal); // @bp:shadow-outer
    int finalValue = marker + recurrence;
    std::printf("core=%d input=%d pointer=%d vector=%d,%d,%d strings=%zu,%zu,%zu,%zu outer=%d\n", finalValue, doubled, *pointer, values[0], values[1], values[2], empty.size(), shortText.size(), longText.size(), utf8.size(), shadow); // @bp:ready
    return 0;
}
