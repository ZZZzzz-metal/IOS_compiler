#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <map>
#include <queue>
#include <string>
#include <unordered_map>
#include <vector>

int recursiveSum(const std::vector<int>& values, int index) {
    if (index == static_cast<int>(values.size())) return 0;
    return values[index] + recursiveSum(values, index + 1);
}

int main() {
    int count = 0;
    if (!(std::cin >> count)) return 2;
    std::vector<int> values;
    std::vector<int> empty;
    for (int i = 0; i < count; ++i) {
        int value = 0;
        if (!(std::cin >> value)) return 3;
        values.push_back(value);
    }
    std::sort(values.begin(), values.end());
    int array[3] = {4, 5, 6};
    int* pointer = &array[1];
    std::string shortText = "中文😀";
    std::string longText(80, 'x');
    std::string emptyText;
    std::map<std::string, int> ordered{{"key", 2}};
    std::unordered_map<int, std::string> hashed{{3, "ok"}};
    std::queue<int> fifo;
    fifo.push(8); fifo.push(9); fifo.pop();
    std::priority_queue<int> heap;
    heap.push(4); heap.push(10);
    std::int64_t big = std::numeric_limits<std::int64_t>::max() - 1;
    std::uint64_t ubig = std::numeric_limits<std::uint64_t>::max();
    auto [key, value] = *ordered.begin(); // C++17 structured binding
    std::cout << "sum=" << recursiveSum(values, 0) << " min=" << values.front()
              << " max=" << values.back() << " pointer=" << *pointer
              << " map=" << key << ':' << value << " hash=" << hashed[3]
              << " queue=" << fifo.front() << " heap=" << heap.top() << '\n';
    std::cout << shortText << " bytes=" << shortText.size() << " long=" << longText.size()
              << " empty=" << empty.size() << '/' << emptyText.size() << '\n';
    std::cout << "i64=" << big << " u64=" << ubig << " int=" << sizeof(int)
              << " long=" << sizeof(long) << " pointer=" << sizeof(void*) << '\n';
}
