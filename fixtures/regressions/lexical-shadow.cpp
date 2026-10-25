int main() {
    int value = 7;
    int result = 0;
    {
        int value = 19;
        result = value; // @bp:inner
    }
    return result == 19 && value == 7 ? 0 : 1; // @bp:outer
}
