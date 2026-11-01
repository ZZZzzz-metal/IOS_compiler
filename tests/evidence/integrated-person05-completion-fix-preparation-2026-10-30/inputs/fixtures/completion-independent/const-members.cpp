struct Reading {
    int read() const { return 2; }
    void mutate() { }
};
void probe(const Reading& item) { item./*<cc>*/ }
