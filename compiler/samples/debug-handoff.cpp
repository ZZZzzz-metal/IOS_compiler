#include <string>
#include <vector>

int add(int value, int increment) {
    int result = value + increment;
    return result;
}

int sum(const std::vector<int>& values, int index) {
    if (index == static_cast<int>(values.size())) return 0;
    int current = values[index];
    return current + sum(values, index + 1);
}

int main() {
    int array[3] = {2, 4, 6};
    int* pointer = &array[1];
    std::vector<int> values = {3, 5, 7};
    std::string shortText = "hello";
    std::string longText(80, 'x');
    int total = sum(values, 0);
    int changed = add(total, *pointer);
    values.push_back(changed);
    return values[3] == 19 && shortText.size() == 5 && longText.size() == 80 ? 0 : 1;
}
