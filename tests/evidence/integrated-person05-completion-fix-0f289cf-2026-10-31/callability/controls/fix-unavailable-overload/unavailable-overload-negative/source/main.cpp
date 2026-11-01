int mixed_a8ee505af129_select(double argument_a8ee505af129) { (void)argument_a8ee505af129; return 0; }
__attribute__((unavailable("person05-unavailable"))) int mixed_a8ee505af129_select(int argument_a8ee505af129) { (void)argument_a8ee505af129; return 0; }
__attribute__((deprecated("person05-deprecated"))) int mixed_a8ee505af129_deprecated() { return 0; }

int main() {
  return mixed_a8ee505af129_select(1);
}
