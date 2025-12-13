use clap::ValueEnum;

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum OutputFormat {
    Table,
    Json,
}

#[allow(dead_code)]
pub fn print_output<T: serde::Serialize>(value: T, output: OutputFormat) -> anyhow::Result<()> {
    match output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&value)?),
        OutputFormat::Table => println!("{}", serde_json::to_string_pretty(&value)?),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::OutputFormat;

    #[test]
    fn output_format_variants() {
        assert!(matches!(OutputFormat::Json, OutputFormat::Json));
    }
}
