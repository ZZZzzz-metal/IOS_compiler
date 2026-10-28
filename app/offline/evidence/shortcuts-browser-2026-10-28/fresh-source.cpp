#include <cstdio> // KEY045-FRESH-OFFLINE-20261028
int bump(int x) {
  int y = x + 1;
  return y;
}
int main() {
  int n = 4;
  int result = bump(n);
  std::printf("KEY045=%d\n", result);
  return 0;
}
