int main() {
    int sum = 0;
    for (int i = 0; i < 3; ++i) { // @bp:header
        sum += i; // @bp:body
    }
    return sum == 3 ? 0 : 1;
}
