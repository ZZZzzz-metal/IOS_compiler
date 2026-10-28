#include <cstdio>
int lift(int n) {
    int answer = n * 2 + 1;
    return answer;
}
int main() {
    int seed = 15;
    int total = lift(seed);
    float negative = -16777216.0f;
    int exactInt = 16777217;
    float nanValue = __builtin_nanf("");
    int zero = 0;
    std::printf("person05-recovered=%d mix=%d bool=%d\n", total, int(negative+exactInt), int(nanValue || (1/zero)));
    return 0;
}
// independent new program entered only after static server stopped
