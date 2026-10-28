#include <cstdio> // KEY045-R3-NEW-SOURCE-20261028
int bump(int x) {
  int y = x + 1;
  return y;
}
int main() {
  int n = 5;
  int result = bump(n);
  std::printf("KEY045R3=%d\n", result);
  return 0;
}
