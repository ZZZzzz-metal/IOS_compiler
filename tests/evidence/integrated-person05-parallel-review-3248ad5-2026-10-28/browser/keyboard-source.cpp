#include <cstdio>
int bump(int n) {
    int answer = n + 3;
    return answer;
}
int main() {
    int seed = 8;
    int total = bump(seed);
    std::printf("person05-key=%d\n", total);
    return 0;
}
// person05 independent shortcuts 2026-10-28
