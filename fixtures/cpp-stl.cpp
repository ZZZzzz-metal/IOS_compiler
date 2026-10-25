#include <algorithm>
#include <cstdio>
#include <map>
#include <queue>
#include <vector>

int main() {
    std::vector<int> emptyValues;
    std::vector<int> values = {9, 2, 6, 2};
    std::sort(values.begin(), values.end());
    std::map<int, int> counts;
    for (int value : values) {
        ++counts[value];
    }
    std::queue<int> pending;
    pending.push(4);
    std::priority_queue<int> heap;
    for (int value : values) {
        heap.push(value);
    }
    auto [key, count] = *counts.begin();
    std::printf("min=%d max=%d first=%d:%d queue=%d heap=%d empty=%zu\n", values.front(), values.back(), key, count, pending.front(), heap.top(), emptyValues.size()); // @bp:ready
    return 0;
}
