int surface_declaration_a8ee505af129_allowed();
__attribute__((unavailable("person05-unavailable"))) int surface_declaration_a8ee505af129_blocked();
__attribute__((deprecated("person05-deprecated"))) int surface_declaration_a8ee505af129_deprecated();
int surface_declaration_a8ee505af129_allowed() { return 0; }
int surface_declaration_a8ee505af129_blocked() { return 0; }
int surface_declaration_a8ee505af129_deprecated() { return 0; }

int main() {
  return surface_declaration_a8ee505af129_deprecated();
}
