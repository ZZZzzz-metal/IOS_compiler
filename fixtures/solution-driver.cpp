#include <cstdio>

// User solution: replace this class when bringing code from a problem app.
class Solution {
public:
    int solve(int left, int right) {
        int answer = left * 2 + right;
        return answer; // @bp:solution-return
    }
};

// Editable local driver: input and expected result remain explicit.
int main() {
    int left = 0;
    int right = 0;
    if (std::scanf("%d %d", &left, &right) != 2) {
        return 2;
    }
    Solution solution;
    int actual = solution.solve(left, right); // @bp:driver-call
    std::printf("answer=%d\n", actual); // @bp:ready
    return 0;
}
