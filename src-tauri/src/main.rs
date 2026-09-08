// Previne a abertura da janela do terminal de console no Windows em builds de release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gestaopro_lib::run();
}
