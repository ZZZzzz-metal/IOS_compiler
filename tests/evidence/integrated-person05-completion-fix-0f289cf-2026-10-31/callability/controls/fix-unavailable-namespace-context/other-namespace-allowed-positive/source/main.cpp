namespace AreaA_a8ee505af129 {
__attribute__((unavailable("person05-unavailable"))) int cross_a8ee505af129_read() { return 0; }
}
namespace AreaB_a8ee505af129 {
int cross_a8ee505af129_read() { return 0; }
}

int main() {
  return AreaB_a8ee505af129::cross_a8ee505af129_read();
}
