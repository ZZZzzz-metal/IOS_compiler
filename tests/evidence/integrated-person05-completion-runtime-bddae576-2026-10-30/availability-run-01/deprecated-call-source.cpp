int personAllowed() { return 1; }
__attribute__((unavailable("person05-unavailable"))) int personBlocked() { return 2; }
__attribute__((deprecated("person05-deprecated"))) int personDeprecated() { return 3; }
int main() { return personDeprecated() - 3; }
